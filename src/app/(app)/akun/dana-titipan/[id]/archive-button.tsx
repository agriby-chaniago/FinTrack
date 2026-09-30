"use client";

import { useRouter } from "next/navigation";

import { FormErrors } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { useMutation } from "@/lib/api-client";

export function ArchiveSubjectButton({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const archive = useMutation<Record<string, never>>(`/api/v1/external-subjects/${subjectId}/archive`);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={buttonClass.secondary}
        disabled={archive.pending}
        onClick={async () => {
          const result = await archive.submit({});
          if (result.ok) router.push("/akun");
        }}
      >
        {archive.pending ? "Menyimpan…" : "Arsipkan"}
      </button>
      <FormErrors errors={archive.error} />
    </div>
  );
}
