import { BerandaSkeleton } from "@/components/skeletons";
import { TabSlide } from "@/components/tab-page";

export default function Loading() {
  return (
    <TabSlide>
      <BerandaSkeleton />
    </TabSlide>
  );
}
