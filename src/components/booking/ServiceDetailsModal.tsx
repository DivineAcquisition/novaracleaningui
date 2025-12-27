import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Info } from "lucide-react";

type ServiceType = "standard" | "deep" | "moveInOut";

interface ServiceDetailsModalProps {
  serviceType: ServiceType;
  trigger?: React.ReactNode;
}

const SERVICE_CHECKLISTS = {
  standard: {
    title: "Standard Cleaning",
    description: "Our regular maintenance cleaning covers all the essentials",
    sections: [
      {
        title: "All Rooms",
        items: [
          "Dust all surfaces and furniture",
          "Vacuum carpets and rugs",
          "Mop hard floors",
          "Empty trash bins",
          "Wipe light switches and door handles",
        ],
      },
      {
        title: "Kitchen",
        items: [
          "Clean countertops and backsplash",
          "Wipe down appliance exteriors",
          "Clean sink and faucet",
          "Wipe cabinet fronts",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean and sanitize toilet",
          "Scrub shower/tub",
          "Clean mirrors and glass",
          "Wipe counters and sink",
          "Mop floors",
        ],
      },
      {
        title: "Bedrooms",
        items: [
          "Change linens (if provided)",
          "Make beds",
          "Dust nightstands and dressers",
          "Vacuum floors",
        ],
      },
    ],
  },
  deep: {
    title: "Deep Cleaning",
    description: "Thorough top-to-bottom cleaning for a fresh start",
    sections: [
      {
        title: "Everything in Standard PLUS",
        items: [
          "Clean inside cabinets and drawers",
          "Detailed baseboard cleaning",
          "Clean window sills and tracks",
          "Dust ceiling fans and light fixtures",
          "Clean behind appliances",
        ],
      },
      {
        title: "Kitchen Deep Clean",
        items: [
          "Degrease stovetop and range hood",
          "Clean inside microwave",
          "Wipe inside oven (add-on for deep clean)",
          "Clean inside refrigerator (add-on)",
          "Descale faucets",
        ],
      },
      {
        title: "Bathroom Deep Clean",
        items: [
          "Descale showerheads",
          "Deep clean grout lines",
          "Clean inside medicine cabinet",
          "Sanitize all surfaces",
          "Polish chrome fixtures",
        ],
      },
    ],
  },
  moveInOut: {
    title: "Move-In/Out Cleaning",
    description: "Complete cleaning for empty or transitioning homes",
    sections: [
      {
        title: "Everything in Deep Clean PLUS",
        items: [
          "Inside all cabinets and closets",
          "Clean inside refrigerator",
          "Clean inside oven",
          "Wipe down all shelving",
          "Clean light fixtures",
        ],
      },
      {
        title: "Detailed Areas",
        items: [
          "Clean inside pantry",
          "Wipe closet shelves and rods",
          "Clean garage entry (if applicable)",
          "Window cleaning (interior)",
          "Clean laundry area",
        ],
      },
      {
        title: "Final Touches",
        items: [
          "HVAC vent covers dusted",
          "Light switch plates cleaned",
          "Door frames wiped down",
          "Outlet covers cleaned",
          "Final walkthrough inspection",
        ],
      },
    ],
  },
};

export function ServiceDetailsModal({ serviceType, trigger }: ServiceDetailsModalProps) {
  const [open, setOpen] = useState(false);
  const service = SERVICE_CHECKLISTS[serviceType];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="gap-1.5 text-primary">
            <Info className="h-4 w-4" />
            What's Included?
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service.title}</DialogTitle>
          <DialogDescription>{service.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {service.sections.map((section, idx) => (
            <div key={idx} className="space-y-2">
              <h4 className="font-semibold text-foreground">{section.title}</h4>
              <ul className="space-y-1.5">
                {section.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
