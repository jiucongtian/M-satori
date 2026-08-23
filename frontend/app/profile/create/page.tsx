import ProfileCreateScreen from "@/src/features/profile/ProfileCreateScreen";
import "@/src/features/legacy/legacy.css";
import { ProtectedRoute } from "@/src/shared/guards";
export default function ProfileCreatePage(){return <ProtectedRoute><ProfileCreateScreen/></ProtectedRoute>;}
