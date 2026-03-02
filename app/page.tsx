import Link from "next/link";
import { Player } from "@/components/Player";
import { BackgroundGradient } from "@/components/ui/background-gradient";
import { isDevAdminEnabled } from "@/lib/devAdmin";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const showDevAdmin = isDevAdminEnabled();

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <BackgroundGradient className="w-full max-w-3xl">
        <section className="space-y-5 p-6 md:p-8">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
              Aceternity + Tailwind
            </p>
            <h1 className="text-2xl font-semibold text-slate-100 md:text-3xl">
              Fan Playback (Dev)
            </h1>
            <p className="text-sm text-slate-300">
              Open assets via deeplink and reuse the recent library.
            </p>
            {showDevAdmin ? (
              <div className="flex flex-col gap-1">
                <Link href="/admin/payees" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
                  Open Dev Admin /admin/payees
                </Link>
                <Link href="/admin/bootstrap" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
                  Open Dev Admin /admin/bootstrap
                </Link>
                <Link href="/admin/upload" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
                  Open Dev Admin /admin/upload
                </Link>
              </div>
            ) : null}
            <Link href="/me/spend" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
              Open Spend Dashboard /me/spend
            </Link>
          </div>
          <Player showOpenButton showRecentList />
        </section>
      </BackgroundGradient>
    </main>
  );
}
