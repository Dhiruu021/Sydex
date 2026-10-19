import { io } from "socket.io-client";
import { getAccessToken } from "./api";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

export function connectChatSocket() {
  return io(new URL(apiUrl).origin, {
    withCredentials: true,
    auth: (callback) => callback({ token: getAccessToken() })
  });
}
