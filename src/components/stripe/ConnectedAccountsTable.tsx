/**
 * ConnectedAccountsTable - Admin component for viewing all Stripe connected accounts
 * 
 * Features:
 * - List all cleaners with Stripe status
 * - Filter by status (active, pending, all)
 * - View account details
 * - Quick payout action
 */

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Search,
  AlertCircle,
  User,
} from 'lucide-react';
import { useStripeConnect, ConnectedAccount } from '@/hooks/useStripeConnect';
import { PayoutForm } from './PayoutForm';
import { cn } from '@/lib/utils';

interface ConnectedAccountsTableProps {
  className?: string;
}

export function ConnectedAccountsTable({ className }: ConnectedAccountsTableProps) {
  const { fetchConnectedAccounts, isLoading } = useStripeConnect();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, pending: 0 });
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCleaner, setSelectedCleaner] = useState<ConnectedAccount | null>(null);
  const [isPayoutDialogOpen, setIsPayoutDialogOpen] = useState(false);

  const loadAccounts = async () => {
    const result = await fetchConnectedAccounts({
      status: statusFilter,
      include_stripe_details: true,
    });

    if (result) {
      setAccounts(result.accounts);
      setSummary(result.summary);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [statusFilter]);

  // Filter accounts by search query
  const filteredAccounts = accounts.filter((account) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      account.name.toLowerCase().includes(query) ||
      account.email.toLowerCase().includes(query) ||
      (account.stripe_account_id?.toLowerCase().includes(query) ?? false)
    );
  });

  const getStatusBadge = (account: ConnectedAccount) => {
    if (account.payouts_enabled && account.charges_enabled) {
      return (
        <Badge className="bg-green-500 text-white">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Active
        </Badge>
      );
    }
    
    if (account.stripe_account_id) {
      const hasPending = (account.stripe_details?.requirements?.pending_verification?.length ?? 0) > 0;
      if (hasPending) {
        return (
          <Badge variant="outline" className="border-blue-300 text-blue-700">
            <Clock className="w-3 h-3 mr-1" />
            Verifying
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-700">
          <AlertCircle className="w-3 h-3 mr-1" />
          Incomplete
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="border-gray-300 text-gray-500">
        <XCircle className="w-3 h-3 mr-1" />
        No Account
      </Badge>
    );
  };

  const handlePayoutClick = (account: ConnectedAccount) => {
    setSelectedCleaner(account);
    setIsPayoutDialogOpen(true);
  };

  const handlePayoutComplete = () => {
    setIsPayoutDialogOpen(false);
    setSelectedCleaner(null);
    // Optionally refresh the list
    loadAccounts();
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cleaners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active (Payouts Enabled)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{summary.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Setup
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{summary.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.total > 0 
                ? `${Math.round((summary.active / summary.total) * 100)}%`
                : '0%'
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or account ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cleaners</SelectItem>
            <SelectItem value="active">Active Only</SelectItem>
            <SelectItem value="pending">Pending Only</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={loadAccounts} disabled={isLoading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cleaner</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Stripe Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requirements</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filteredAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No cleaners found
                </TableCell>
              </TableRow>
            ) : (
              filteredAccounts.map((account) => (
                <TableRow key={account.cleaner_id}>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell className="text-muted-foreground">{account.email}</TableCell>
                  <TableCell>
                    {account.stripe_account_id ? (
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {account.stripe_account_id.slice(0, 15)}...
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(account)}</TableCell>
                  <TableCell>
                    {account.stripe_details?.requirements?.currently_due?.length ? (
                      <span className="text-xs text-amber-600">
                        {account.stripe_details.requirements.currently_due.length} items due
                      </span>
                    ) : account.stripe_details?.requirements?.pending_verification?.length ? (
                      <span className="text-xs text-blue-600">
                        Under review
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!account.payouts_enabled}
                          onClick={() => handlePayoutClick(account)}
                        >
                          <DollarSign className="w-4 h-4 mr-1" />
                          Payout
                        </Button>
                      </DialogTrigger>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Payout Dialog */}
      <Dialog open={isPayoutDialogOpen} onOpenChange={setIsPayoutDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Send Payout</DialogTitle>
            <DialogDescription>
              Send a payout to {selectedCleaner?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedCleaner && (
            <PayoutForm
              cleanerId={selectedCleaner.cleaner_id}
              cleanerName={selectedCleaner.name}
              onSuccess={handlePayoutComplete}
              onCancel={() => setIsPayoutDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ConnectedAccountsTable;
