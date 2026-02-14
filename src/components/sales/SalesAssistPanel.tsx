import { useSalesScripts } from "@/hooks/use-sales-data";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, MessageSquare, Zap, Lightbulb, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SalesAssistPanelProps {
  activeChannel: string;
  currentStep: string;
}

export function SalesAssistPanel({ activeChannel, currentStep }: SalesAssistPanelProps) {
  const { data: objections } = useSalesScripts("objection");
  const { data: closingScripts } = useSalesScripts("closing");
  const { data: channelTips } = useSalesScripts("channel_tip");
  const { data: talkingPoints } = useSalesScripts("talking_point");

  const copyScript = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Script copied!");
  };

  // Find the relevant channel tip
  const activeChannelTip = channelTips?.find(
    (t) => t.trigger_context === activeChannel
  );

  // Find relevant talking point for current step
  const activeTalkingPoint = talkingPoints?.find(
    (t) => t.trigger_context === currentStep
  );

  return (
    <div className="space-y-4">
      {/* Active Channel Guidance */}
      {activeChannelTip && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold mb-1">
            <MessageSquare className="w-3 h-3" />
            {activeChannel} Tips
          </div>
          <p className="text-sm text-slate-300">{activeChannelTip.script_text}</p>
        </div>
      )}

      {/* Contextual Talking Point */}
      {activeTalkingPoint && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
              <Lightbulb className="w-3 h-3" />
              Say This Now
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-slate-400 hover:text-white"
              onClick={() => copyScript(activeTalkingPoint.script_text)}
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
          <p className="text-sm text-slate-300 italic">"{activeTalkingPoint.script_text}"</p>
        </div>
      )}

      {/* Closing Techniques */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Closing Techniques
        </h4>
        <div className="space-y-1.5">
          {closingScripts?.map((script) => (
            <div
              key={script.id}
              className="group flex items-start gap-2 p-2 rounded-lg hover:bg-slate-800/50 cursor-pointer"
              onClick={() => copyScript(script.script_text)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white">{script.title}</div>
                <div className="text-xs text-slate-400 truncate">{script.script_text}</div>
              </div>
              <Copy className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5" />
            </div>
          ))}
        </div>
      </div>

      {/* Objection Handling */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> Objection Handling
        </h4>
        <Accordion type="single" collapsible className="space-y-1">
          {objections?.map((script) => (
            <AccordionItem
              key={script.id}
              value={script.id}
              className="border border-slate-700 rounded-lg overflow-hidden"
            >
              <AccordionTrigger className="px-3 py-2 text-sm text-white hover:no-underline hover:bg-slate-800/50 [&[data-state=open]]:bg-slate-800/50">
                {script.title}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                <p className="text-sm text-slate-300 mb-2">{script.script_text}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-slate-400 hover:text-white"
                  onClick={() => copyScript(script.script_text)}
                >
                  <Copy className="w-3 h-3 mr-1" /> Copy Script
                </Button>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
