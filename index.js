const express = require('express');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables from .env file.
dotenv.config();

const app = express();
const port = process.env.PORT || 3000; // Use port 3000 for backend

// Initialize Prisma Client
const prisma = new PrismaClient();

// Middleware to parse JSON bodies
app.use(express.json());

// Function to fetch table names and their columns using raw SQL
async function getTableAndColumnNames() {
  try {
    // Query information_schema to get table and column details (MySQL)
    const result = await prisma.$queryRaw`
      SELECT
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        COLUMN_TYPE
      FROM
        information_schema.COLUMNS
      WHERE
        TABLE_SCHEMA = DATABASE()
      ORDER BY
        TABLE_NAME,
        ORDINAL_POSITION;
    `;

    // Group columns by table
    const tables = {};
    result.forEach(row => {
      if (!tables[row.TABLE_NAME]) {
        tables[row.TABLE_NAME] = [];
      }
      tables[row.TABLE_NAME].push({
        column_name: row.COLUMN_NAME,
        data_type: row.DATA_TYPE,
        column_type: row.COLUMN_TYPE,
      });
    });

    return tables;

  } catch (error) {
    console.error('Error fetching table and column names:', error);
    throw error;
  }
}

// API endpoint to get table and column names
app.get('/api/tables', async (req, res) => {
  try {
    const tables = await getTableAndColumnNames();
    res.json(tables);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch table and column names' });
  }
});

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Choose a model
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Function to get SQL query from Gemini
async function getSqlQueryFromGemini(userQuery, dbSchema) {
  const prompt = `Given the following database schema for the 'classicmodels' database:
${dbSchema}

Translate the following natural language query into a SQL query for MySQL. Only return the SQL query and nothing else.

When the query asks for a comparison, ranking, or values associated with entities (e.g., sales by customer, products by category), ensure the SELECT clause includes both the entity's identifying column(s) and the calculated value(s).

Natural language query: "${userQuery}"

SQL query:`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    // Clean up code blocks if any
    const sqlQuery = text.replace(/```sql/g, '').replace(/```/g, '').trim();
    return sqlQuery;
  } catch (error) {
    console.error('Error generating SQL query with Gemini:', error);
    throw new Error('Failed to generate SQL query.');
  }
}

// Function to recursively convert BigInt to string in an object
function convertBigIntToString(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  }

  const newObj = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === 'bigint') {
        newObj[key] = value.toString();
      } else {
        newObj[key] = convertBigIntToString(value);
      }
    }
  }
  return newObj;
}

app.post('/api/query', async (req, res) => {
  const userQuery = req.body.query;
  console.log('Received user query:', userQuery);

  if (!userQuery) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    // 1. Fetch the DB schema dynamically
    const dbSchemaObj = await getTableAndColumnNames();
    const dbSchemaText = Object.entries(dbSchemaObj).map(([table, columns]) => {
      const cols = columns.map(col => `${col.column_name} (${col.data_type})`).join(', ');
      return `- ${table}: ${cols}`;
    }).join('\n');

    // 2. Get SQL query from Gemini
    let sqlQuery = await getSqlQueryFromGemini(userQuery, dbSchemaText);
    console.log('Generated SQL query:', sqlQuery);

    // Function to modify SQL query for charting if needed
    function modifySqlQueryForCharting(query) {
        const lowerQuery = query.toLowerCase();
        const orderByMatch = lowerQuery.match(/order by\s+(.*?)(asc|desc|$)/);

        if (orderByMatch && orderByMatch[1]) {
            const orderByClause = orderByMatch[1].trim();
            // Check if the ORDER BY clause contains an aggregate function
            const aggregateMatch = orderByClause.match(/(sum|count|avg|min|max)\s*\(/);

            if (aggregateMatch) {
                const aggregateFunction = aggregateMatch[0];
                // Check if the SELECT clause already includes this aggregate
                const selectMatch = lowerQuery.match(/select\s+(.*?)\s+from/);
                if (selectMatch && selectMatch[1]) {
                    const selectClause = selectMatch[1];
                    if (!selectClause.includes(aggregateFunction)) {
                        // Add the aggregate function to the SELECT clause with an alias
                        const alias = `${aggregateMatch[1]}_value`; // Simple alias
                        const modifiedSelect = selectClause + `, ${aggregateFunction} AS ${alias}`;
                        return query.replace(selectClause, modifiedSelect);
                    }
                }
            }
        }
        return query; // Return original query if no modification needed
    }

    // Modify SQL query for charting purposes
    sqlQuery = modifySqlQueryForCharting(sqlQuery);
    console.log('Modified SQL query for charting:', sqlQuery);


    // 3. Run the SQL query
    let result = await prisma.$queryRawUnsafe(sqlQuery);
    console.log('SQL Result:', result);

    // Convert BigInt values to string for JSON serialization
    result = convertBigIntToString(result);

    // 4. Generate a natural language summary using Gemini
    const explanationPrompt = `
You are an assistant that receives SQL query results as JSON. Your task is to produce a clear, natural language summary for the end user based on their question.

User question: "${userQuery}"

SQL query: \`${sqlQuery}\`

SQL result (in JSON format): 
\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

Please write a concise and natural answer listing the relevant data clearly without repeating JSON keys.  
- If the result contains customer names, list them separated by commas.  
- If the result contains multiple rows, you can summarize as "There are X entries: ..." or list items.  
- Do not include any code blocks or raw JSON in your response.  
- Make it friendly and easy to read.
`;

    const explanationResult = await model.generateContent(explanationPrompt);
    const explanationText = await (await explanationResult.response).text();

    // Function to determine if a chart is needed based on user query
    async function shouldGenerateChart(userQuery) {
      const chartPrompt = `Given the user query: "${userQuery}", determine if a chart visualization would be appropriate for the result. Consider queries that ask for comparisons, trends, distributions, or rankings as appropriate for charts. Examples of chart-appropriate queries: "Show me the total sales by customer", "What are the sales trends over time?", "Show the distribution of products by category", "Compare the sales performance of different employees", "What are the top 10 selling products?". Respond with "YES" if a chart is appropriate, and "NO" otherwise. Only respond with "YES" or "NO".`;
      try {
        const result = await model.generateContent(chartPrompt);
        const response = await result.response;
        const text = await response.text();
        return text.trim().toUpperCase() === 'YES';
      } catch (error) {
        console.error('Error determining if chart is needed:', error);
        return false; // Default to no chart on error
      }
    }

    // Function to transform data for charting
    function transformDataForChart(data) {
      if (!Array.isArray(data) || data.length === 0) return null;

      const firstRow = data[0];
      const columnNames = Object.keys(firstRow);

      let labelColumn = null;
      let valueColumn = null;

      // Attempt to find a string column for labels and a number column for values
      for (const colName of columnNames) {
        const sampleValue = firstRow[colName];
        if (typeof sampleValue === 'string' && labelColumn === null) {
          labelColumn = colName;
        } else if (typeof sampleValue === 'number' && valueColumn === null) {
          valueColumn = colName;
        }
        if (labelColumn !== null && valueColumn !== null) break; // Found both, exit loop
      }

      // Fallback to first two columns if specific types not found
      if (labelColumn === null && columnNames.length > 0) labelColumn = columnNames[0];
      if (valueColumn === null && columnNames.length > 1) valueColumn = columnNames[1];

      if (labelColumn === null || valueColumn === null) {
          console.error("Could not determine label and value columns for charting.");
          return null; // Cannot create chart data without both
      }

      const labels = data.map(row => row[labelColumn]);
      const dataValues = data.map(row => row[valueColumn]);
      const datasetLabel = valueColumn || 'Value'; // Use the determined value column name as dataset label

      return {
        type: 'bar', // Default chart type, can be made dynamic based on data or query
        labels: labels,
        datasets: [
          {
            label: datasetLabel,
            data: dataValues,
            backgroundColor: 'rgba(75, 192, 192, 0.6)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1
          }
        ]
      };
    }

    let chartData = null;
    let generateChart = false;

    // Check for keywords in the user query to force chart generation
    const chartKeywords = ['chart', 'plot', 'graph', 'visualize'];
    const containsChartKeyword = chartKeywords.some(keyword => userQuery.toLowerCase().includes(keyword));

    if (containsChartKeyword) {
      generateChart = true;
      console.log('Chart keyword found, forcing chart generation.');
    } else {
      try {
        generateChart = await shouldGenerateChart(userQuery);
        console.log('Should generate chart (Gemini):', generateChart); // Log to check if chart generation is triggered by Gemini
      } catch (chartCheckError) {
        console.error('Error in shouldGenerateChart:', chartCheckError);
        // Continue without generating chart if check fails
      }
    }


    if (generateChart) {
      try {
        chartData = transformDataForChart(result);
        console.log('Generated chart data:', JSON.stringify(chartData, null, 2)); // Log the generated chart data
      } catch (transformError) {
        console.error('Error in transformDataForChart:', transformError);
        chartData = null; // Ensure chartData is null if transformation fails
      }
    }

    // 5. Send response including the raw SQL, raw result, the summary text, and chart data
    res.json({
      query: sqlQuery,
      result: result,
      summary: explanationText.trim(),
      chart: chartData,
    });

  } catch (error) {
    console.error('Error processing query:', error);
    // Log the specific error that caused the 500 status
    console.error('Details of 500 error:', error);
    res.status(500).json({ error: error.message || 'Failed to process query' });
  }
});

// Basic route
app.get('/', (req, res) => {
  res.send('Backend is running!');
});

// Start the server
app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
