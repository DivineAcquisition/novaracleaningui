import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Star, MapPin, Calendar, TrendingUp } from "lucide-react";
import { SEO } from "@/components/SEO";

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  state: string | null;
  home_zip: string | null;
  status_today: string | null;
  approved: boolean;
  available_for_bookings: boolean;
  max_travel_miles: number | null;
  preferred_work_days: string[] | null;
  average_rating: number | null;
  total_ratings: number | null;
  jobs_assigned_last_7d: number | null;
  workload_score: number | null;
  weighted_score: number | null;
  completed_bookings: number | null;
  acceptance_rate: number | null;
  on_time_rate: number | null;
}

export default function CleanerDirectory() {
  const { toast } = useToast();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [filteredCleaners, setFilteredCleaners] = useState<Cleaner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchCleaners = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .order("weighted_score", { ascending: true });

      if (error) throw error;

      setCleaners((data as any) || []);
      setFilteredCleaners((data as any) || []);
    } catch (error: any) {
      console.error("Error fetching cleaners:", error);
      toast({
        title: "Error",
        description: "Failed to load cleaners",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCleaners();
  }, []);

  useEffect(() => {
    let filtered = cleaners;

    if (searchQuery) {
      filtered = filtered.filter(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (stateFilter) {
      filtered = filtered.filter(c => c.state === stateFilter);
    }

    if (statusFilter) {
      filtered = filtered.filter(c => c.status_today === statusFilter);
    }

    setFilteredCleaners(filtered);
  }, [searchQuery, stateFilter, statusFilter, cleaners]);

  const getAvailabilityBadge = (status: string | null) => {
    return status === "Available" 
      ? <Badge variant="default">Available</Badge>
      : <Badge variant="secondary">Unavailable</Badge>;
  };

  const getRatingDisplay = (rating: number | null, count: number | null) => {
    if (!count || count === 0) return <span className="text-muted-foreground text-sm">No reviews</span>;
    
    return (
      <div className="flex items-center gap-1">
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        <span className="font-medium">{rating?.toFixed(1) || '0.0'}</span>
        <span className="text-sm text-muted-foreground">({count})</span>
      </div>
    );
  };

  const uniqueStates = Array.from(new Set(cleaners.map(c => c.state).filter(Boolean)));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <SEO title="Cleaner Directory" noindex />
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold font-jakarta">Cleaner Directory</h1>
          <p className="text-muted-foreground">
            View and manage all cleaners in your network
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Total Cleaners</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cleaners.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Available Today</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {cleaners.filter(c => c.status_today === "Available").length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Approved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {cleaners.filter(c => c.approved).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Avg Rating</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                <div className="text-2xl font-bold">
                  {(cleaners.reduce((sum, c) => sum + (c.average_rating || 0), 0) / cleaners.filter(c => c.total_ratings > 0).length || 0).toFixed(1)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
              >
                <option value="">All States</option>
                {uniqueStates.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>

              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                <option value="Available">Available</option>
                <option value="Unavailable">Unavailable</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Cleaners Table */}
        <Card>
          <CardHeader>
            <CardTitle>Cleaners ({filteredCleaners.length})</CardTitle>
            <CardDescription>
              Sorted by weighted score (best performers first)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Work Days</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>On-Time Rate</TableHead>
                  <TableHead>Acceptance Rate</TableHead>
                  <TableHead>Last 7 Days</TableHead>
                  <TableHead>Workload</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCleaners.map((cleaner) => (
                  <TableRow key={cleaner.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {cleaner.first_name} {cleaner.last_name}
                        </div>
                        <div className="text-sm text-muted-foreground">{cleaner.email}</div>
                        {!cleaner.approved && (
                          <Badge variant="outline" className="mt-1">Pending Approval</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div>{cleaner.state}</div>
                          <div className="text-sm text-muted-foreground">
                            {cleaner.home_zip} · {cleaner.max_travel_miles}mi
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getAvailabilityBadge(cleaner.status_today)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {cleaner.preferred_work_days?.map(day => (
                          <Badge key={day} variant="outline" className="text-xs">
                            {day}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{getRatingDisplay(cleaner.average_rating, cleaner.total_ratings)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={
                          (cleaner.on_time_rate || 0) >= 90 ? 'text-green-600' :
                          (cleaner.on_time_rate || 0) >= 75 ? 'text-yellow-600' :
                          'text-red-600'
                        }>
                          {cleaner.on_time_rate?.toFixed(1) || 0}%
                        </span>
                        {(cleaner.on_time_rate || 0) >= 90 && <span>🟢</span>}
                        {(cleaner.on_time_rate || 0) >= 75 && (cleaner.on_time_rate || 0) < 90 && <span>🟡</span>}
                        {(cleaner.on_time_rate || 0) < 75 && <span>🔴</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={
                        (cleaner.acceptance_rate || 0) >= 80 ? 'text-green-600' :
                        (cleaner.acceptance_rate || 0) >= 60 ? 'text-yellow-600' :
                        'text-red-600'
                      }>
                        {cleaner.acceptance_rate?.toFixed(1) || 0}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{cleaner.jobs_assigned_last_7d}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span>{cleaner.workload_score.toFixed(1)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={cleaner.weighted_score < 0.3 ? "default" : cleaner.weighted_score < 0.6 ? "secondary" : "outline"}
                      >
                        {cleaner.weighted_score.toFixed(2)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
