import { Card, CardContent, Button } from "@heroui/react";

export default function LicensesPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Licenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate and manage license keys
          </p>
        </div>
        <Button variant="primary" size="sm">
          Generate Key
        </Button>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          License key management — coming in Phase 7.
        </CardContent>
      </Card>
    </div>
  );
}
