import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/sydex-test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "a-test-access-secret-that-is-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "a-test-refresh-secret-that-is-at-least-32-characters";

const { app, isAllowedClientOrigin } = await import("./app.js");

describe("Phase 1 API", () => {
  beforeAll(() => {
    expect(app).toBeDefined();
  });

  it("reports API health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("allows Vite's alternate local development port", () => {
    expect(isAllowedClientOrigin("http://localhost:5174", "development", "http://localhost:5173")).toBe(true);
  });

  it("does not allow unrelated origins", () => {
    expect(isAllowedClientOrigin("https://example.com", "development", "http://localhost:5173")).toBe(false);
  });

  it("does not allow non-configured origins outside development", () => {
    expect(isAllowedClientOrigin("http://localhost:5174", "production", "http://localhost:5173")).toBe(false);
  });

  it("rejects malformed email addresses before issuing an OTP", async () => {
    const response = await request(app).post("/api/v1/auth/request-otp").send({ email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("protects profile routes from unauthenticated access", async () => {
    const response = await request(app).get("/api/v1/profile");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  it("protects chat directory and conversation routes from unauthenticated access", async () => {
    const responses = await Promise.all([
      request(app).get("/api/v1/users/lookup?email=person%40example.com"),
      request(app).get("/api/v1/users"),
      request(app).get("/api/v1/conversations"),
      request(app).post("/api/v1/conversations/direct").send({ userId: "0123456789abcdef01234567" }),
      request(app).post("/api/v1/conversations/groups").send({ title: "Team", participantIds: [] }),
      request(app).get("/api/v1/conversations/0123456789abcdef01234567/messages"),
      request(app).post("/api/v1/conversations/0123456789abcdef01234567/messages").send({ text: "Hello" })
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });

  it("validates email addresses before looking up a chat recipient", async () => {
    const token = jwt.sign({ sub: "0123456789abcdef01234567" }, process.env.JWT_ACCESS_SECRET!);
    const response = await request(app)
      .get("/api/v1/users/lookup?email=not-an-email")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("does not return cached API responses for conditional requests", async () => {
    const response = await request(app)
      .get("/api/v1/profile")
      .set("If-None-Match", '"cached-profile"');

    expect(response.status).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeUndefined();
  });
});
