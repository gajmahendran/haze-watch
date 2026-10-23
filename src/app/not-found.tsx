import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap py-20">
      <h1 className="text-3xl">This page does not exist</h1>
      <p className="mt-4 text-ash measure">
        The address may be mistyped, or the page may have moved. Try the <Link href="/live">live dashboard</Link>, the{" "}
        <Link href="/history">haze timeline</Link> or the <Link href="/">home page</Link>.
      </p>
    </div>
  );
}
