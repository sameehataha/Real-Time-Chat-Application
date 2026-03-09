const corsOption = {
  origin: [
    "https://real-time-chat-application-frontend-ex6823h9o.vercel.app",
    "https://real-time-chat-application-frontend-h9xpu3ht9.vercel.app",
    "https://real-time-chat-application-frontend-rho.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};


const TALKIE_TOKEN = "talkie-token";

export { corsOption, TALKIE_TOKEN };