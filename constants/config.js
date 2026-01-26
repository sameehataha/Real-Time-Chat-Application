const corsOption = {
  origin: [
    "https://real-time-chat-application.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ],
  credentials: true,
  methods: ["GET", "POST"],
};


const TALKIE_TOKEN = "talkie-token";

export { corsOption, TALKIE_TOKEN };
