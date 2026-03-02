import Link from "next/link";
import { BoostHistory } from "@/components/BoostHistory";
import { BoostPanel } from "@/components/BoostPanel";
import { Player } from "@/components/Player";
import { BackgroundGradient } from "@/components/ui/background-gradient";

type PageProps = {
  params: Promise<{
    assetId: string;
  }>;
};

export default async function AssetPage({ params }: PageProps) {
  const { assetId: rawAssetId } = await params;
  const assetId = rawAssetId.trim();

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <BackgroundGradient className="w-full max-w-3xl">
        <section className="space-y-5 p-6 md:p-8">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Asset Playback</p>
            <h1 className="text-2xl font-semibold text-slate-100 md:text-3xl">/asset/{assetId}</h1>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
                Back to home
              </Link>
              <Link
                href="/me/spend"
                className="text-sm text-cyan-300 underline-offset-2 hover:underline"
              >
                Spend dashboard
              </Link>
            </div>
          </div>
          <Player
            initialAssetId={assetId}
            showValidateButton
            showEncryptedPreflightButton
            showAccessStatus
            bootstrapDeviceOnMount
          />
          <BoostPanel assetId={assetId} />
          <BoostHistory assetId={assetId} />
        </section>
      </BackgroundGradient>
    </main>
  );
}
