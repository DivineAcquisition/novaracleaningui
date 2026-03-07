import {
  RiCloseLine,
  RiDeleteBinLine,
  RiMapPinLine,
  RiSearchLine
} from "@remixicon/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  maxCleaners?: number;
  onCleanerDeleted?: (cleanerId: string) => void;
}

export function CleanerMultiSelect({
  cleaners,
  selectedCleaners,
  onSelectionChange,
  maxCleaners = 3,
  onCleanerDeleted,
}: CleanerMultiSelectProps) {
  const [searchFilter, setSearchFilter] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteCleaner = async (cleaner: CleanerOption) => {
    if (!confirm(`Deactivate ${cleaner.first_name} ${cleaner.last_name}? They will be removed from the available pool.`)) return;
    setDeletingId(cleaner.id);
    try {
      const { error } = await supabase.from("cleaners").update({ approved: false } as any).eq("id", cleaner.id);
      if (error) throw error;
      // Remove from selected if present
      onSelectionChange(selectedCleaners.filter(c => c.id !== cleaner.id));
      onCleanerDeleted?.(cleaner.id);
      toast.success(`${cleaner.first_name} ${cleaner.last_name} deactivated`);
    } catch (err: any) {
      toast.error("Failed to deactivate: " + err.message);
    } finally { setDeletingId(null); }
  };

  const filteredCleaners = cleaners.filter(c => {
    if (!searchFilter) return true;
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    return fullName.includes(searchFilter.toLowerCase());
  });

  const handleToggleCleaner = (cleaner: CleanerOption) => {
    const isSelected = selectedCleaners.some(c => c.id === cleaner.id);
    
    if (isSelected) {
      const remaining = selectedCleaners.filter(c => c.id !== cleaner.id);
      if (remaining.length > 0 && !remaining.some(c => c.role === 'Lead')) {
        remaining[0].role = 'Lead';
      }
      onSelectionChange(remaining);
    } else {
      if (selectedCleaners.length >= maxCleaners) return;
      
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

  const handleRemoveCleaner = (cleanerId: string) => {
    const remaining = selectedCleaners.filter(c => c.id !== cleanerId);
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
            <Label className="font-semibold">Selected Cleaners ({selectedCleaners.length}/{maxCleaners})</Label>
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
                      <RiMapPinLine className="w-3 h-3" />
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
                    <Label className="text-xs">Pay Rate</Label>
                    <Input
                      type="text"
                      value={`$${cleaner.hourlyRate}/hr`}
                      readOnly
                      className="h-8 text-sm bg-muted"
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
                <RiCloseLine className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Search Filter */}
      <div className="relative">
        <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search cleaners by name..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Available Cleaners */}
      <div className="space-y-2">
        <Label className="font-semibold">
          Available Cleaners {selectedCleaners.length >= maxCleaners && "(Max reached)"}
        </Label>
        
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {filteredCleaners.map((cleaner) => {
            const isSelected = selectedCleaners.some(c => c.id === cleaner.id);
            const isDisabled = !isSelected && selectedCleaners.length >= maxCleaners;
            
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
                        <RiMapPinLine className="w-3 h-3" />
                        {cleaner.distance} mi away
                      </span>
                    )}
                    <span>${cleaner.pay_rate_hr || 18}/hr</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); handleDeleteCleaner(cleaner); }}
                  disabled={deletingId === cleaner.id}
                  title="Deactivate cleaner"
                >
                  <RiDeleteBinLine className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
          {filteredCleaners.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {searchFilter ? "No cleaners match your search" : "No cleaners available"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
