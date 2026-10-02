import { AccountsSkeleton } from "@/components/skeletons";
import { TabSlide } from "@/components/tab-page";

export default function Loading() {
  return (
    <TabSlide>
      <AccountsSkeleton title="Akun" description="Saldo tercatat per akun. Uang pribadi = saldo fisik dikurangi dana titipan." />
    </TabSlide>
  );
}
