import ProfileCreateScreen from "@/src/features/profile/ProfileCreateScreen";
import PrototypeProfileCreateScreen from "@/src/features/profile/PrototypeProfileCreateScreen";
import "@/src/features/legacy/legacy.css";
import { ProtectedRoute } from "@/src/shared/guards";
import { PROTOTYPE_MODE } from "@/src/shared/prototype";
function ActiveProfileCreateScreen(){return PROTOTYPE_MODE?<PrototypeProfileCreateScreen/>:<ProfileCreateScreen/>;}
export default function ProfileCreatePage(){return <ProtectedRoute><ActiveProfileCreateScreen/></ProtectedRoute>;}
