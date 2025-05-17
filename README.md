# Database Chatbot with AI

This project is a full-stack application that allows users to interact with a MySQL database using natural language queries. It utilizes a Node.js/Express backend with Prisma for database interaction and a React frontend for the user interface. Google's Gemini AI is used to translate natural language questions into SQL queries and to summarize the results.

## Features

*   Natural language to SQL query translation using Google Gemini.
*   Execution of generated SQL queries against a MySQL database.
*   Natural language summary of query results using Google Gemini.
*   Dynamic fetching of database schema.
*   Frontend chat interface for user interaction.
*   Display of query results as tables or charts.

## Technologies Used

*   **Backend:** Node.js, Express, Prisma, dotenv, Google Generative AI
*   **Frontend:** React, react-chartjs-2
*   **Database:** MySQL

## Setup Instructions

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Piyush2510verma/SQL_Agent
    cd SQL-agent
    ```
2.  **Set up Environment Variables:**
    Create a `.env` file in the root directory of the project. This file should contain:
    *   `DATABASE_URL`: Your MySQL database connection string (e.g., `mysql://user:password@host:port/database`).
    *   `GEMINI_API_KEY`: Your API key for Google Generative AI.

    Example `.env` file:
    ```env
    DATABASE_URL="mysql://your_user:your_password@your_host:your_port/your_database"
    GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
    PORT=3000 # Optional, defaults to 3000
    ```
3.  **Install Dependencies:**
    Install backend dependencies:
    ```bash
    npm install
    ```
    Navigate to the frontend directory and install frontend dependencies:
    ```bash
    cd frontend
    npm install
    cd ..
    ```
4.  **Prisma Setup:**
    Since the schema is fetched dynamically, you don't need to run `prisma migrate`. However, you might need to generate the Prisma client if it's not already generated (though `npm install` should handle this).
    ```bash
    npx prisma generate
    ```

## How to Run the Application

1.  **Start the Backend:**
    In the root directory, run:
    ```bash
    node index.js
    ```
    The backend server will start, typically on port 3000 (or the port specified in your `.env` file).
2.  **Start the Frontend:**
    In the `frontend/` directory, run:
    ```bash
    npm start
    ```
    The React development server will start, usually opening the application in your browser at `http://localhost:3001`.

The frontend will automatically connect to the backend running on `http://localhost:3000`.

## API Endpoints

*   `GET /api/tables`: Returns the database schema (table and column names).
*   `POST /api/query`: Accepts a natural language query in the request body (`{ "query": "your question" }`), translates it to SQL, executes it, and returns the result, summary, and potential chart data.

## Deployment

(Add deployment instructions here based on the chosen hosting platforms for frontend and backend)
