import { Card, CardContent } from "@heroui/react";

export default function UsersPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Registered Woxus users and their devices
        </p>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          User management — coming in Phase 7.
        </CardContent>
      </Card>
    </div>
  );
}
