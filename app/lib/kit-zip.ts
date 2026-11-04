// Brand kit export: the kit's chunk files as a zip, built in the browser (spec: JSZip), so the
// download costs nothing and never touches the server.
export async function downloadKitZip(slug: string, businessName: string, files: Record<string, string>) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folder = zip.folder(`${slug}-brand-kit`)!;
  for (const [name, text] of Object.entries(files)) folder.file(name, text);
  folder.file(
    "EXPORTED.txt",
    `${businessName} brand kit, exported from Specs (specs.humanbuiltai.work) on ${new Date().toISOString().slice(0, 10)}.\n` +
      `Start with readme.md: it says which files to read for each job. _retrieval-rules.yaml lists them as task profiles.\n` +
      `Every chunk opens with front matter saying where its facts came from and how sure the kit is of them.\n`,
  );
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}-brand-kit.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
