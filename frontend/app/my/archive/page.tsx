import { MyArchiveScreen } from "@/src/features/my/MyScreens";
import { ProtectedRoute } from "@/src/shared/guards";
export default function MyArchivePage(){return <ProtectedRoute><MyArchiveScreen/></ProtectedRoute>;}
