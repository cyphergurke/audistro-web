import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPayeesForm } from "@/components/AdminPayeesForm";
import { BackgroundGradient } from "@/components/ui/background-gradient";
import { isDevAdminEnabled } from "@/lib/devAdmin";

export default function AdminPayeesPage() {
  if (!isDevAdminEnabled()) {
    notFound();
  }

  const defaultFAPPublicBaseURL =
    process.env.NEXT_PUBLIC_FAP_PUBLIC_BASE_URL?.trim() || "http://localhost:18081";
  const defaultLNBitsBaseURL =
    process.env.NEXT_PUBLIC_DEV_ADMIN_DEFAULT_LNBITS_BASE_URL?.trim() || "http://lnbits:5000";

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <BackgroundGradient className="w-full max-w-4xl">
        <section className="space-y-5 p-6 md:p-8">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Dev Admin</p>
            <h1 className="text-2xl font-semibold text-slate-100 md:text-3xl">/admin/payees</h1>
            <Link href="/" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
              Back to home
            </Link>
          </div>
          <AdminPayeesForm
            defaultFAPPublicBaseURL={defaultFAPPublicBaseURL}
            defaultLNBitsBaseURL={defaultLNBitsBaseURL}
          />
        </section>
      </BackgroundGradient>
    </main>
  );
}
