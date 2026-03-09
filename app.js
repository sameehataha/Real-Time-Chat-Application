import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import userRoute from "./routes/user.js";
import { connectDB } from "./utils/features.js";
import { errorMiddleware } from "./middlewares/error.js";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createServer } from "http";
import chatRoute from "./routes/chat.js";
import adminRoute from "./routes/admin.js";
import {
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  NEW_ATTACHMENTS,
  START_TYPING,
  STOP_TYPING,
  CHAT_JOINED,
  CHAT_LEAVE,
  ONLINE_USERS,
} from "./constants/events.js";

import { v4 as uuidv4 } from "uuid";
import { getSockets } from "./lib/helper.js";
import { Message } from "./models/message-model.js";
import { Chat } from "./models/chat-model.js";
import { v2 as cloudinary } from "cloudinary";
import { corsOption } from "./constants/config.js";
import { socketAuthenticator } from "./middlewares/auth.js";

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;
const envMode = process.env.NODE_ENV.trim() || "PRODUCTION";
const adminSecretKey = process.env.ADMIN_SECRET_KEY || "admin1234";
const userSocketId = new Map();
const onlineUsers = new Set();

console.log("MONGO_URI =", process.env.MONGO_URI);
connectDB(MONGO_URI);
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
console.log("Cloudinary configured");
console.log(`Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);
console.log(`API Key: ${process.env.CLOUDINARY_API_KEY}`);
console.log(`API Secret: ${process.env.CLOUDINARY_API_SECRET}`);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOption,
  transports: ["websocket", "polling"],
});

// Store io instance on app for use in route handlers
app.set("io", io);

// CORS Configuration
app.use(cors(corsOption));

// Using middleware here
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Using routes here
app.use("/api/v1/user", userRoute);
app.use("/api/v1/chat", chatRoute);
app.use("/api/v1/admin", adminRoute);

app.get("/", (req, res) => {
  res.send("Chat Server Running");
});

// SOCKET AUTHENTICATION MIDDLEWARE
io.use((socket, next) => {
  console.log("\nSocket authentication attempt...");
  console.log("Socket ID:", socket.id);

  cookieParser()(socket.request, socket.request.res, async (err) => {
    if (err) {
      console.error("Cookie parser error:", err.message);
    }
    await socketAuthenticator(err, socket, (authErr) => {
      if (authErr) {
        console.error("Authentication failed:", authErr.message);
        next(authErr);
      } else {
        console.log("Authentication successful!");
        next();
      }
    });
  });
});

// SOCKET CONNECTION HANDLER
io.on("connection", (socket) => {
  const user = socket.user;
  const userId = user._id.toString();
  console.log("SOCKET CONNECTED");
  console.log(`User: ${user.name} (${userId})`);
  console.log(`Socket ID: ${socket.id}`);

  // CHECK IF USER ALREADY CONNECTED - DISCONNECT OLD SOCKET
  const existingSocketId = userSocketId.get(userId);
  if (existingSocketId) {
    console.log(
      `User already has socket ${existingSocketId}, disconnecting old one`,
    );
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    if (existingSocket) {
      existingSocket.disconnect(true);
    }
  }

  // SET NEW SOCKET
  userSocketId.set(userId, socket.id);
  console.log(`Socket registered in map`);
  console.log(`Total users connected: ${userSocketId.size}`);
  console.log(
    `User-Socket Map:`,
    Array.from(userSocketId.entries()).map((e) => `${e[0].slice(0, 8)}...`),
  );

  // TEXT MESSAGE EVENT HANDLER
  socket.on(NEW_MESSAGE, async ({ chatId, message, members }) => {
    console.log("NEW MESSAGE EVENT");
    console.log(`From: ${user.name}`);
    console.log(`Chat: ${chatId}`);
    console.log(`Message: "${message}"`);
    console.log(`Members: ${members.length}`);

    const messageForRealTime = {
      content: message,
      _id: uuidv4(),
      sender: { _id: user._id, name: user.name },
      chatId,
      createdAt: new Date().toISOString(),
    };

    const messageForDB = {
      content: message,
      sender: user._id,
      chat: chatId,
    };

    //EMIT MESSAGE TO ALL USERS IN THIS CHAT ROOM
    console.log(`\nBroadcasting message to room: ${chatId}`);
    io.to(chatId).emit(NEW_MESSAGE, { chatId, message: messageForRealTime });
    console.log(`Message sent to room`);

    //SEND ALERT TO EACH MEMBER NOT VIEWING THIS CHAT
    console.log(`\nSending alerts to members...`);
    let sent = 0;

    for (const memberId of members) {
      const memberIdStr = memberId.toString();
      const memberSocket = userSocketId.get(memberIdStr);

      // Skip if sender or offline
      if (memberSocket === socket.id || !memberSocket) {
        console.log(`Skipping member: ${memberIdStr.slice(0, 8)}...`);
        continue;
      }

      // SEND ALERT
      console.log(`Sending alert to: ${memberIdStr.slice(0, 8)}...`);
      io.to(memberSocket).emit(NEW_MESSAGE_ALERT, { chatId, count: 1 });
      sent++;
    }

    console.log(`Alerts sent to ${sent} members`);

    //SAVE TO DATABASE
    try {
      await Message.create(messageForDB);
      console.log(`Message saved`);
    } catch (err) {
      console.error(`DB Error:`, err.message);
    }
  });

  // TYPING IN THE CHAT
  socket.on(START_TYPING, ({ chatId }) => {
    console.log("start-typing", chatId);
    // Broadcast to everyone in the room EXCEPT the sender
    socket.to(chatId).emit(START_TYPING, { chatId });
  });

  socket.on(STOP_TYPING, ({ chatId }) => {
    console.log("stop-typing", chatId);
    socket.to(chatId).emit(STOP_TYPING, { chatId });
  });

  // ATTACHMENTS EVENT HANDLER
  socket.on(NEW_ATTACHMENTS, async (data) => {
    console.log("NEW ATTACHMENTS EVENT RECEIVED");
    console.log(`From: ${user.name} (${userId})`);

    const { chatId, message } = data;

    if (!message) {
      console.error(`No message data in attachment event!`);
      return;
    }

    console.log(`Chat ID: ${chatId}`);
    console.log(`Message ID: ${message._id}`);
    console.log(`Attachments count: ${message?.attachments?.length || 0}`);

    // Get the chat to find all members
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) {
        console.error(`Chat not found!`);
        return;
      }

      const memberIds = chat.members.map((m) => m.toString());
      console.log(`\nFound ${memberIds.length} chat members`);

      // Prepare message for real-time emission
      const messageForRealTime = {
        _id: message._id || uuidv4(),
        content: message.content || "",
        attachments: message.attachments || [],
        sender: message.sender || {
          _id: user._id,
          name: user.name,
        },
        chat: message.chat || chatId,
        createdAt: message.createdAt || new Date().toISOString(),
      };

      console.log(`\nBroadcasting message to chat room: ${chatId}`);

      // Broadcast the message with attachments to all members in the chat room
      io.to(chatId).emit(NEW_ATTACHMENTS, {
        message: messageForRealTime,
        chatId,
      });
      console.log(`NEW_ATTACHMENTS emitted to room: ${chatId}`);

      //IMPORTANT: Send alert ONLY to members NOT in this chat
      console.log(`\nSending alerts to members NOT in this chat...`);

      let alertCount = 0;
      memberIds.forEach((memberId) => {
        const memberSocket = userSocketId.get(memberId);

        console.log(`Member: ${memberId.slice(0, 8)}...`);
        console.log(
          `Socket ID: ${memberSocket ? memberSocket.slice(0, 8) + "..." : "NOT CONNECTED"}`,
        );

        // Only send alert to members who are NOT the sender AND are online
        if (memberSocket && memberSocket !== socket.id) {
          console.log(`Sending alert to this member`);
          io.to(memberSocket).emit(NEW_MESSAGE_ALERT, {
            chatId,
            count: 1,
          });
          alertCount++;
        } else if (memberSocket === socket.id) {
          console.log(`Skipping (this is the sender)`);
        } else {
          console.log(`Member not online`);
        }
      });

      console.log(`\nAlerts sent to ${alertCount} members`);
    } catch (err) {
      console.error(`Error processing attachments:`, err.message);
    }
  });

  // JOIN CHAT ROOM
  socket.on("JOIN_CHAT", (chatId) => {
    console.log("JOIN CHAT ROOM");
    console.log(`User: ${user.name} (${userId})`);
    console.log(`Chat ID: ${chatId}`);
    console.log(`Socket ID: ${socket.id}`);

    socket.join(chatId);
    console.log(`User joined room: ${chatId}`);
  });

  // LEAVE CHAT ROOM
  socket.on("LEAVE_CHAT", (chatId) => {
    console.log("LEAVE CHAT ROOM");
    console.log(`User: ${user.name} (${userId})`);
    console.log(`Chat ID: ${chatId}`);
    console.log(`Socket ID: ${socket.id}`);

    socket.leave(chatId);
    console.log(`User left room: ${chatId}`);
  });
  // DISCONNECT HANDLER
  // TO SHOW ONLINE OFFLINE USERS
  socket.on(CHAT_JOINED, ({ members }) => {
    console.log(`CHAT_JOINED event received from: ${userId}`);
    onlineUsers.add(userId);
    const membersSockets = getSockets(members);

    io.to(membersSockets).emit(ONLINE_USERS, Array.from(onlineUsers));
    console.log(`USER_ONLINE broadcast for: ${userId}`);
  });

  socket.on(CHAT_LEAVE, ({ members }) => {
    console.log(`CHAT_LEAVE event received from: ${userId}`);

    onlineUsers.delete(userId);
    const membersSockets = getSockets(members);

    io.to(membersSockets).emit(ONLINE_USERS, Array.from(onlineUsers));
    console.log(`USER_OFFLINE broadcast for: ${userId}`);
  });
  // Update disconnect handler
  socket.on("disconnect", () => {
    console.log("SOCKET DISCONNECTED");
    console.log(`Socket ID: ${socket.id}`);
    console.log(`User: ${user.name} (${userId})`);

    // Notify others that user is offline
    io.emit("USER_OFFLINE", {
      userId,
      socketId: socket.id,
    });

    userSocketId.delete(userId);
    onlineUsers.delete(userId);
    socket.broadcast.emit(ONLINE_USERS, Array.from(onlineUsers));
    console.log(`Users remaining: ${userSocketId.size}`);
  });
});

// ERROR MIDDLEWARE
app.use(errorMiddleware);

// SERVER STARTUP
httpServer.listen(PORT, () => {
  console.log("SERVER STARTED");
  console.log(`Port: ${PORT}`);
  console.log(`Mode: ${envMode}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
});

export { envMode, adminSecretKey, userSocketId };
