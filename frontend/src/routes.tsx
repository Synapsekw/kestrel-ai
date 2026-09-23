import { createBrowserRouter } from "react-router-dom";
import { Shell } from "@/app/Shell";
import { ProjectsScreen } from "@/screens/ProjectsScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { DataManagerScreen } from "@/screens/DataManagerScreen";
import { EditorScreen } from "@/screens/EditorScreen";
import { LabelResolverScreen } from "@/screens/LabelResolverScreen";
import { ReviewScreen } from "@/screens/ReviewScreen";
import { DatasetsScreen } from "@/screens/DatasetsScreen";
import { ModelsScreen } from "@/screens/ModelsScreen";
import { TrainScreen } from "@/screens/TrainScreen";
import { QueryScreen } from "@/screens/QueryScreen";
import { MapsScreen } from "@/screens/MapsScreen";
import { ExportScreen } from "@/screens/ExportScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { AppSettingsScreen } from "@/screens/AppSettingsScreen";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <ProjectsScreen /> },
      { path: "settings", element: <AppSettingsScreen /> },
      { path: "p/:projectId", element: <HomeScreen /> },
      { path: "p/:projectId/data", element: <DataManagerScreen /> },
      { path: "p/:projectId/label", element: <LabelResolverScreen /> },
      { path: "p/:projectId/edit/:imageId", element: <EditorScreen /> },
      { path: "p/:projectId/review", element: <ReviewScreen /> },
      { path: "p/:projectId/datasets", element: <DatasetsScreen /> },
      { path: "p/:projectId/models", element: <ModelsScreen /> },
      { path: "p/:projectId/train", element: <TrainScreen /> },
      { path: "p/:projectId/query", element: <QueryScreen /> },
      { path: "p/:projectId/maps", element: <MapsScreen /> },
      { path: "p/:projectId/maps/:mapId", element: <MapsScreen /> },
      { path: "p/:projectId/export", element: <ExportScreen /> },
      { path: "p/:projectId/settings", element: <SettingsScreen /> },
    ],
  },
]);
