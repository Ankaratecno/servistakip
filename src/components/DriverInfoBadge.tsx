import { BusFront, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SERVICE_INFO } from "@/lib/service-config";

export default function DriverInfoBadge() {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute left-1/2 top-5 z-[520] -translate-x-1/2">
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Şoför bilgilerini göster"
        className="h-12 gap-2 rounded-full border border-border bg-card/95 px-4 text-foreground shadow-lg backdrop-blur"
      >
        <BusFront className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="whitespace-nowrap text-base font-bold">{SERVICE_INFO.plate}</span>
        <ChevronRight
          className={`h-4 w-4 text-primary transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </Button>

      {open && (
        <div className="absolute right-0 top-14 w-60 rounded-md border border-primary/50 bg-card/95 p-4 text-primary shadow-xl backdrop-blur">
          <div className="mb-3 border-b border-primary/30 pb-2 text-xs font-black uppercase">
            Şoför Bilgileri
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs font-bold">
            <dt>ŞOFÖR ADI</dt>
            <dd>{SERVICE_INFO.driverName}</dd>
            <dt>YAŞ</dt>
            <dd>{SERVICE_INFO.driverAge}</dd>
            <dt>EHLİYET</dt>
            <dd>{SERVICE_INFO.licenseClasses}</dd>
            <dt>KAN GRUBU</dt>
            <dd>{SERVICE_INFO.bloodType}</dd>
            <dt>SRC</dt>
            <dd>{SERVICE_INFO.srcClasses}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
