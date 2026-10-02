import { CardsSkeleton } from "@/components/skeletons";
import { TabSlide } from "@/components/tab-page";

export default function Loading() {
  return (
    <TabSlide>
      <CardsSkeleton title="Aktivitas" cards={4} />
    </TabSlide>
  );
}
