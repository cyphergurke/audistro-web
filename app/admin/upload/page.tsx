import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminUploadForm } from "@/components/AdminUploadForm";
import { BackgroundGradient } from "@/components/ui/background-gradient";
import { isDevAdminEnabled } from "@/lib/devAdmin";

export const dynamic = "force-dynamic";

export default function AdminUploadPage() {
  if (!isDevAdminEnabled()) {
    notFound();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <BackgroundGradient className="w-full max-w-4xl">
        <section className="space-y-5 p-6 md:p-8">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Dev Admin</p>
            <h1 className="text-2xl font-semibold text-slate-100 md:text-3xl">/admin/upload</h1>
            <div className="flex gap-4 text-sm text-cyan-300">
              <Link href="/" className="underline-offset-2 hover:underline">
                Back to home
              </Link>
              <Link href="/admin/bootstrap" className="underline-offset-2 hover:underline">
                Create artist + payee
              </Link>
            </div>
          </div>
          <AdminUploadForm />
        </section>
      </BackgroundGradient>
    </main>
  );
}
