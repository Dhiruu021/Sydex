import { io } from "socket.io-client";
import { apiUrl, getAccessToken } from "./api";

export function connectChatSocket() {
  return io(new URL(apiUrl).origin, {
    withCredentials: true,
    auth: (callback) => callback({ token: getAccessToken() })
  });
}
