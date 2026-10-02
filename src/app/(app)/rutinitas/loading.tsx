import { CardsSkeleton } from "@/components/skeletons";
import { TabSlide } from "@/components/tab-page";

export default function Loading() {
  return (
    <TabSlide>
      <CardsSkeleton title="Rutinitas" description="Settlement mingguan, konfirmasi bulanan, dan transfer ke reserve." />
    </TabSlide>
  );
}
