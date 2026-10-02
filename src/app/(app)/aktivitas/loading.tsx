import { ListSkeleton } from "@/components/skeletons";
import { TabSlide } from "@/components/tab-page";

export default function Loading() {
  return (
    <TabSlide>
      <ListSkeleton title="Aktivitas" description="Semua catatan, urut dari yang terakhir dicatat. Catatan tidak pernah dihapus; koreksi tampil sebagai catatan baru." />
    </TabSlide>
  );
}
