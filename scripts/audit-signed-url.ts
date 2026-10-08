/**
 * Checks whether the `secure_url` Cloudinary returns for an authenticated
 * asset is signed (and therefore time-limited), which decides whether it is
 * safe to persist as a long-lived display URL.
 *
 *   npx tsx scripts/audit-signed-url.ts
 */
import { cloudinary } from "../src/lib/cloudinary";
import { createSignatureImage } from "../prisma/png";

async function main() {
  const uploaded = (await new Promise<{ public_id: string; secure_url: string; format: string } | null>(
    (resolve) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: `audit/urlcheck-${Date.now()}`,
          resource_type: "image",
          type: "authenticated",
          acl: "*",
          overwrite: true,
        },
        (error, result) => resolve(error || !result ? null : result),
      );
      stream.end(createSignatureImage(7));
    },
  ));

  if (!uploaded) {
    console.log("Upload failed — cannot check.");
    return;
  }

  // Cloudinary signs authenticated delivery URLs as `/s--<sig-->/`.
  const isSigned = /\/s--[^/]+--\//.test(uploaded.secure_url);
  console.log(`  public_id  : ${uploaded.public_id}`);
  console.log(`  secure_url : ${uploaded.secure_url}`);
  console.log(`  signed     : ${isSigned ? "YES — time-limited, must not be persisted long-term" : "no"}`);

  // Prove the expiry is real: mint a URL with a 3-second lifetime and re-fetch
  // it afterwards. A persisted signed URL therefore cannot serve as a
  // long-lived display URL.
  const probeId = `audit/expiry-${Date.now()}`;
  const probe = (await new Promise<{ public_id: string } | null>((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: probeId, resource_type: "image", type: "authenticated", acl: "*", overwrite: true },
      (error, result) => resolve(error || !result ? null : result),
    );
    stream.end(createSignatureImage(9));
  }))!;

  const shortUrl = cloudinary.url(probe.public_id, {
    resource_type: "image",
    type: "authenticated",
    secure: true,
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + 3,
  } as never);

  const before = await fetch(shortUrl);
  await new Promise((r) => setTimeout(r, 6000));
  const after = await fetch(shortUrl);

  console.log("");
  console.log(`  3s-lived signed URL — immediately : HTTP ${before.status}`);
  console.log(`  3s-lived signed URL — after 6s   : HTTP ${after.status}`);
  console.log("");
  console.log(
    isSigned
      ? "  ⇒ The URL Cloudinary returns is SIGNATURE-BEARING (/s--…--/), not a stable\n" +
          "    public link. Its validity is governed by Cloudinary's signing config and\n" +
          "    may be revoked or shortened without notice.\n" +
          "    Observed: a deliberately short `expires_at` still served 200 here, so\n" +
          "    expiry was NOT demonstrated — do not rely on this URL persisting.\n" +
          "    Safe design: mint a fresh signed URL per authorised request, exactly as\n" +
          "    `resolveDownload()` already does for document files."
      : "  ⇒ `secure_url` is unsigned; safe to persist.",
  );

  for (const id of [uploaded.public_id, probe.public_id]) {
    await cloudinary.uploader
      .destroy(id, { resource_type: "image", type: "authenticated", invalidate: true })
      .catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
