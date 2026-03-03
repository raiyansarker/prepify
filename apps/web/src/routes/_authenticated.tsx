import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
