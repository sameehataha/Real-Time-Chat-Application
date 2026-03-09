import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import { getSockets } from "../lib/helper.js";

const cookieOption = {
  maxAge: 15 * 24 * 60 * 60 * 1000,
  sameSite: "none", // Always 'none' for cross-domain cookies
  secure: true, // Always true for cross-domain cookies (HTTPS required)
  httpOnly: true,
};

// Separate option for admin cookies with shorter expiration
const adminCookieOption = {
  maxAge: 15 * 60 * 1000, // 15 minutes
  sameSite: "none", // Always 'none' for cross-domain
  secure: true, // Always true for cross-domain
  httpOnly: true,
};

const connectDB = (url) => {
  mongoose
    .connect(url, { dbName: "Talkie" })
    .then((data) => console.log(`Connected to DB: ${data.connection.host}`))
    .catch((err) => {
      throw err;
    });
};

const sendToken = (res, user, code, message) => {
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET);
  return res.status(code).cookie("talkie-token", token, cookieOption).json({
    success: true,
    message,
    user,
    token,
  });
};

/**
 * Emit real-time events via Socket.io
 */
const emitEvent = (req, event, users, data) => {
  const io = req.app.get("io");
  const usersSockets = getSockets(users);

  if (io && usersSockets && usersSockets.length > 0) {
    io.to(usersSockets).emit(event, data);
    console.log(`Event "${event}" emitted to ${usersSockets.length} sockets`);
  } else {
    console.warn(`Socket emission failed for event "${event}"`);
  }
};

/**
 * Upload files to Cloudinary
 * Returns format: {public_id, url} to match Message & User model schema
 */
const uploadFilesToCloudinary = async (files = []) => {
  if (!files || files.length === 0) {
    throw new Error("No files provided for upload");
  }

  console.log(`Uploading ${files.length} file(s) to Cloudinary...`);

  const uploadPromises = files.map((file) => {
    return new Promise((resolve, reject) => {
      try {
        if (!file.buffer) {
          throw new Error(`File ${file.originalname} has no buffer`);
        }

        // Convert file buffer to base64 data URI
        const base64String = file.buffer.toString("base64");
        const dataURI = `data:${file.mimetype};base64,${base64String}`;

        cloudinary.uploader.upload(
          dataURI,
          {
            resource_type: "auto",
            folder: "talkie_uploads",
            timeout: 60000,
          },
          (error, result) => {
            if (error) {
              console.error(
                `Upload error for ${file.originalname}:`,
                error.message,
              );
              return reject(error);
            }
            resolve(result);
          },
        );
      } catch (err) {
        reject(err);
      }
    });
  });

  try {
    const results = await Promise.all(uploadPromises);

    // Message model: attachments[{public_id, url}]
    // User model: avatar{public_id, url}
    const formattedResults = results.map((result) => ({
      public_id: result.public_id,
      url: result.secure_url, // Use secure_url (https)
    }));

    console.log(`Uploaded ${formattedResults.length} file(s) successfully`);
    return formattedResults;
  } catch (err) {
    console.error(`Cloudinary upload failed:`, err.message);
    throw new Error(`File upload failed: ${err.message}`);
  }
};

const deleteFilesFromCloudinary = async (public_ids = []) => {
  if (!public_ids || public_ids.length === 0) return;

  console.log(`Deleting ${public_ids.length} file(s) from Cloudinary...`);

  const deletePromises = public_ids.map((id) => {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(id, (error, result) => {
        if (error) {
          console.warn(`Delete failed for ${id}:`, error.message);
          return reject(error);
        }
        resolve(result);
      });
    });
  });

  try {
    await Promise.all(deletePromises);
    console.log(`Files deleted from Cloudinary`);
  } catch (err) {
    console.error(`Delete error:`, err.message);
  }
};

export {
  connectDB,
  sendToken,
  cookieOption,
  adminCookieOption,
  emitEvent,
  deleteFilesFromCloudinary,
  uploadFilesToCloudinary,
};