import { ErrorHandler } from "../utils/utility.js";
import { TryCatch } from "./error.js";
import jwt from "jsonwebtoken";
import { adminSecretKey } from "../app.js";

import { TALKIE_TOKEN } from "../constants/config.js";
import { User } from "../models/user-model.js";

const isAuthenticated = TryCatch(async (req, res, next) => {
  // Try to get token from cookies first
  let token = req.cookies[TALKIE_TOKEN];
  
  // If no cookie, try Authorization header
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7); // Remove "Bearer " prefix
    }
  }

  if (!token) {
    return next(new ErrorHandler("please login to access this route", 401));
  }

  try {
    const decodeData = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Token verified, user ID:", decodeData._id);
    req.user = decodeData._id;
    next();
  } catch (error) {
    return next(new ErrorHandler("Invalid or expired token", 401));
  }
});

const adminOnly = (req, res, next) => {
  console.log("=== AdminOnly Middleware Check ===");
  console.log(" All Cookies:", req.cookies);
  console.log("Cookie Header:", req.headers.cookie);

  // Try to get token from cookies
  const token = req.cookies["talkie-admin-token"];

  if (!token) {
    console.log(" No talkie-admin-token found");
    console.log("Available cookie keys:", Object.keys(req.cookies));
    return next(new ErrorHandler("Unauthorized - No admin token", 401));
  }

  try {
    console.log(
      "Verifying token with JWT_SECRET:",
      process.env.JWT_SECRET ? "✓ Set" : "✗ Not set",
    );

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("Token verified successfully");
    console.log("Decoded payload:", decoded);

    // Attach admin info to request
    req.admin = decoded;
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return next(new ErrorHandler(`Invalid token: ${error.message}`, 401));
  }
};

const socketAuthenticator = async (err, socket, next) => {
  try {
    // Log initial state
    console.log("\n Socket authenticator running...");
    console.log("Socket ID:", socket.id);

    if (err) {
      console.error("Pre-existing error:", err.message);
      return next(new Error(err.message));
    }

    // Try to get token from cookies first
    let authToken = socket.request.cookies[TALKIE_TOKEN];

    // If no cookie, try Authorization header from socket handshake
    if (!authToken && socket.handshake.headers.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith("Bearer ")) {
        authToken = authHeader.slice(7);
      }
    }
if (!authToken && socket.handshake.auth?.token) {
  authToken = socket.handshake.auth.token;
}
    console.log("Token found:", authToken ? "Yes" : "No");

    if (!authToken) {
      console.error(" No auth token found in cookies or headers");
      return next(new Error("No authentication token"));
    }

    try {
      const decodeData = jwt.verify(authToken, process.env.JWT_SECRET);
      console.log(" Token verified for user ID:", decodeData._id);

      const user = await User.findById(decodeData._id);

      if (!user) {
        console.error(" User not found in database");
        return next(new Error("User not found"));
      }

      console.log(" User found:", user.name);
      socket.user = user;
      console.log("Socket user set, proceeding to connection");
      return next();
    } catch (tokenErr) {
      console.error("Token verification error:", tokenErr.message);
      return next(new Error("Invalid or expired token"));
    }
  } catch (error) {
    console.error("Socket authenticator error:", error.message);
    return next(new Error("Authentication failed"));
  }
};

export { isAuthenticated, adminOnly, socketAuthenticator };