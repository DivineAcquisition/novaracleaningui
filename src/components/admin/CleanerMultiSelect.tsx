import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, MapPin } from "lucide-react";

export interface SelectedCleaner {
  id: string;
  name: string;
  role: 'Lead' | 'Support';
  hourlyRate: number;
  distance: number;
}

interface CleanerOption {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  distance?: number;
  home_lat?: number;
  home_lng?: number;
  pay_rate_hr: number;
}

interface CleanerMultiSelectProps {
  cleaners: CleanerOption[];
  selectedCleaners: SelectedCleaner[];
  onSelectionChange: (cleaners: SelectedCleaner[]) => void;
}

export function CleanerMultiSelect({
  cleaners,
  selectedCleaners,
  onSelectionChange,
}: CleanerMultiSelectProps) {
  const handleToggleCleaner = (cleaner: CleanerOption) => {
    const isSelected = selectedCleaners.some(c => c.id === cleaner.id);
    
    if (isSelected) {
      onSelectionChange(selectedCleaners.filter(c => c.id !== cleaner.id));
    } else {
      if (selectedCleaners.length >= 3) {
        return; // Max 3 cleaners
      }
      
      const newCleaner: SelectedCleaner = {
        id: cleaner.id,
        name: `${cleaner.first_name} ${cleaner.last_name}`,
        role: selectedCleaners.length === 0 ? 'Lead' : 'Support',
        hourlyRate: cleaner.pay_rate_hr || 18,
        distance: cleaner.distance || 0,
      };
      
      onSelectionChange([...selectedCleaners, newCleaner]);
    }
  };

  const handleRoleChange = (cleanerId: string, role: 'Lead' | 'Support') => {
    onSelectionChange(
      selectedCleaners.map(c => 
        c.id === cleanerId ? { ...c, role } : c
      )
    );
  };

  const handleHourlyRateChange = (cleanerId: string, rate: number) => {
    const validRate = Math.max(18, Math.min(20, rate)); // Enforce 18-20 range
    onSelectionChange(
      selectedCleaners.map(c => 
        c.id === cleanerId ? { ...c, hourlyRate: validRate } : c
      )
    );
  };

  const handleRemoveCleaner = (cleanerId: string) => {
    const remaining = selectedCleaners.filter(c => c.id !== cleanerId);
    
    // If removing the lead, promote first remaining to lead
    if (remaining.length > 0 && !remaining.some(c => c.role === 'Lead')) {
      remaining[0].role = 'Lead';
    }
    
    onSelectionChange(remaining);
  };

  return (
    <div className="space-y-4">
      {/* Selected Cleaners */}
      {selectedCleaners.length > 0 && (
        <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="font-semibold">Selected Cleaners ({selectedCleaners.length}/3)</Label>
          </div>
          
          {selectedCleaners.map((cleaner) => (
            <div key={cleaner.id} className="flex items-center gap-3 p-3 bg-background rounded-lg border">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium">{cleaner.name}</span>
                  <Badge variant={cleaner.role === 'Lead' ? 'default' : 'secondary'}>
                    {cleaner.role}
                  </Badge>
                  {cleaner.distance > 0 && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {cleaner.distance} mi
                    </span>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Role</Label>
                    <Select 
                      value={cleaner.role} 
                      onValueChange={(value) => handleRoleChange(cleaner.id, value as 'Lead' | 'Support')}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Lead">Lead</SelectItem>
                        <SelectItem value="Support">Support</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-1">
                    <Label className="text-xs">Hourly Rate ($18-$20)</Label>
                    <Input
                      type="number"
                      min={18}
                      max={20}
                      step={1}
                      value={cleaner.hourlyRate}
                      onChange={(e) => handleHourlyRateChange(cleaner.id, parseFloat(e.target.value))}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              </div>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveCleaner(cleaner.id)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Available Cleaners */}
      <div className="space-y-2">
        <Label className="font-semibold">
          Available Cleaners {selectedCleaners.length >= 3 && "(Max reached)"}
        </Label>
        
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {cleaners.map((cleaner) => {
            const isSelected = selectedCleaners.some(c => c.id === cleaner.id);
            const isDisabled = !isSelected && selectedCleaners.length >= 3;
            
            return (
              <div
                key={cleaner.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  isSelected ? 'bg-primary/5 border-primary' : 'bg-background'
                } ${isDisabled ? 'opacity-50' : ''}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => handleToggleCleaner(cleaner)}
                  disabled={isDisabled}
                />
                
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {cleaner.first_name} {cleaner.last_name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {cleaner.status}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {cleaner.distance !== undefined && cleaner.distance > 0 && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {cleaner.distance} mi away
                      </span>
                    )}
                    <span>${cleaner.pay_rate_hr || 18}/hr</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
