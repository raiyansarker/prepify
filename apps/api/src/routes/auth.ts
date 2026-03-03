import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { users } from "#/db/schema";
import { Webhook } from "svix";

export const authRoutes = new Elysia({ prefix: "/auth" }).post(
  "/webhook",
  async ({ body, request, set }) => {
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      set.status = 400;
      return { success: false, error: "Missing svix headers" };
    }

    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      set.status = 500;
      return { success: false, error: "Webhook secret not configured" };
    }

    let payload: any;
    try {
      const wh = new Webhook(webhookSecret);
      payload = wh.verify(JSON.stringify(body), {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      set.status = 400;
      return { success: false, error: "Invalid webhook signature" };
    }

    const eventType = payload.type as string;
    const data = payload.data as any;

    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const email =
          data.email_addresses?.find(
            (e: any) => e.id === data.primary_email_address_id,
          )?.email_address ?? data.email_addresses?.[0]?.email_address;

        await db
          .insert(users)
          .values({
            clerkId: data.id,
            email: email ?? "",
            name:
              [data.first_name, data.last_name].filter(Boolean).join(" ") ||
              null,
            avatar: data.image_url ?? null,
          })
          .onConflictDoUpdate({
            target: users.clerkId,
            set: {
              email: email ?? "",
              name:
                [data.first_name, data.last_name].filter(Boolean).join(" ") ||
                null,
              avatar: data.image_url ?? null,
              updatedAt: new Date(),
            },
          });
        break;
      }

      case "user.deleted": {
        if (data.id) {
          await db.delete(users).where(eq(users.clerkId, data.id));
        }
        break;
      }
    }

    return { success: true };
  },
);
