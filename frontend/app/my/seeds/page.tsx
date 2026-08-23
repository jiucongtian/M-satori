import { MySeedsScreen } from "@/src/features/my/MyScreens";
import { ProtectedRoute } from "@/src/shared/guards";
export default function MySeedsPage(){return <ProtectedRoute><MySeedsScreen/></ProtectedRoute>;}
