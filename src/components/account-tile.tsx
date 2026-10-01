// Account tile (PRD v0.20 P8): the provider's app icon, the cash glyph, or a
// monogram. Decorative: the account name is always written next to it.
import Image from "next/image";

import bca from "@/assets/providers/bca.png";
import dana from "@/assets/providers/dana.png";
import jago from "@/assets/providers/jago.png";
import { Icon, Monogram } from "@/components/ui";
import { accountTile, monogramFor } from "@/lib/account-icon";

const icons = { bca, dana, jago };

export function AccountTile({ account, index }: { account: { displayName: string; providerName: string; accountType: string }; index: number }) {
  const kind = accountTile(account);
  if (kind === "cash") {
    return (
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center bg-primary-soft text-primary">
        <Icon name="cash" className="size-5" />
      </span>
    );
  }
  if (kind) return <Image src={icons[kind]} alt="" width={40} height={40} className="size-10 shrink-0" />;
  return <Monogram {...monogramFor(account.displayName, index)} />;
}
