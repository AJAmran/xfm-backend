/**
 * Diagnostics for the Cloudinary storage provider.
 *
 * Verifies that the configured credentials can (a) upload an authenticated
 * asset, and (b) read it back through a short-lived signed URL. Run it whenever
 * the document module reports a storage error:
 *
 *   npx tsx scripts/diagnose-storage.ts
 */
import { cloudinary } from "../src/lib/cloudinary";
import { isCloudinaryConfigured, activeProvider } from "../src/lib/storage.service";
import env from "../src/config/env";
import { createSignatureImage } from "../prisma/png";

async function main() {
  console.log("\n🔌 Storage diagnostics\n");
  console.log(`  Active provider : ${activeProvider()}`);
  console.log(`  Cloudinary creds: ${isCloudinaryConfigured() ? "configured" : "MISSING"}`);
  console.log(`  cloud_name      : ${env.cloudinary_cloud_name ?? "(unset)"}`);
  console.log(`  api_key         : ${env.cloudinary_api_key ? "set" : "(unset)"}`);
  console.log(`  api_secret      : ${env.cloudinary_api_secret ? "set" : "(unset)"}\n`);

  if (!isCloudinaryConfigured()) {
    console.log("  → Falling back to the local secure store (var/storage/). Nothing to test.\n");
    return;
  }

  const publicId = `diagnostics/probe-${Date.now()}`;
  const bytes = createSignatureImage(42);

  const uploaded = await new Promise<{ public_id: string; bytes: number; format: string } | null>((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "image",
        type: "authenticated",
        acl: "*",
        overwrite: true,
      },
      (error, result) => {
        if (error || !result) {
          console.log("  ✖ UPLOAD FAILED:", JSON.stringify(error));
          resolve(null);
          return;
        }
        resolve({ public_id: result.public_id, bytes: result.bytes ?? 0, format: result.format ?? "" });
      },
    );
    stream.end(bytes);
  });

  if (!uploaded) {
    console.log("\n  → Upload failed, so signed downloads cannot work. Check the credentials.\n");
    return;
  }

  console.log(`  ✓ Uploaded ${uploaded.public_id} (${uploaded.bytes} bytes, ${uploaded.format})`);

  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const signedUrl = cloudinary.url(uploaded.public_id, {
    resource_type: "image",
    type: "authenticated",
    secure: true,
    sign_url: true,
    expires_at: expiresAt,
  } as never);
  console.log(`  → Signed URL: ${signedUrl}`);

  const response = await fetch(signedUrl);
  console.log(`  ${response.ok ? "✓" : "✖"} Signed download: HTTP ${response.status} ${response.statusText}`);
  if (response.ok) {
    const roundTrip = Buffer.from(await response.arrayBuffer());
    console.log(`  ${roundTrip.equals(bytes) ? "✓" : "✖"} Bytes round-trip intact (${roundTrip.length})`);
  } else {
    const body = await response.text().catch(() => "");
    console.log(`  ✖ Response body: ${body.slice(0, 300)}`);
    console.log(
      "  → Cloudinary rejects signed URLs on authenticated assets unless the upload\n" +
        "    declares an `acl`. Confirm the upload used `acl: \"*\"` (see storage.service.ts).",
    );
  }

  // Clean up the probe asset so the account is left as we found it.
  await cloudinary.uploader
    .destroy(uploaded.public_id, { resource_type: "image", type: "authenticated", invalidate: true })
    .catch(() => undefined);
  console.log("  ✓ Probe asset removed\n");
}

main().catch((error) => {
  console.error("Diagnostics failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
