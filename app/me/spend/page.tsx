import Link from "next/link";
import { SpendDashboard } from "@/components/SpendDashboard";
import { BackgroundGradient } from "@/components/ui/background-gradient";

export default function SpendPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <BackgroundGradient className="w-full max-w-4xl">
        <section className="space-y-5 p-6 md:p-8">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
              Fan Transparency
            </p>
            <h1 className="text-2xl font-semibold text-slate-100 md:text-3xl">
              Where Did My Money Go
            </h1>
            <Link href="/" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
              Back to home
            </Link>
          </div>
          <SpendDashboard />
        </section>
      </BackgroundGradient>
    </main>
  );
}
