import { Route, Switch } from "wouter";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
import { Provider } from "./components/provider";
import { AppShell } from "./components/layout/app-shell";
import Index from "./pages/index";
import AiInterviewRoom from "./pages/ai-interview-room";
import Dashboard from "./pages/dashboard";
import Clients from "./pages/clients";
import Jobs from "./pages/jobs";
import JobDetail from "./pages/job-detail";
import Candidates from "./pages/candidates";
import CandidateDetail from "./pages/candidate-detail";
import Matching from "./pages/matching";
import Matrix from "./pages/matrix";
import Flagged from "./pages/flagged";
import HiddenGems from "./pages/hidden-gems";
import Reports from "./pages/reports";
import ReportDetail from "./pages/report-detail";
import Operations from "./pages/operations";
import Screening from "./pages/screening";
import AiInterviews from "./pages/ai-interviews";
import TechInterviews from "./pages/tech-interviews";
import Placed from "./pages/placed";
import Copilot from "./pages/copilot";
import Settings from "./pages/settings";
import Backup from "./pages/backup";

/** Authenticated area — everything renders inside the app shell. */
function Workspace() {
  return (
    <AppShell>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/copilot" component={Copilot} />
        <Route path="/clients" component={Clients} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/candidates" component={Candidates} />
        <Route path="/candidates/:id" component={CandidateDetail} />
        <Route path="/matching" component={Matching} />
        <Route path="/matrix" component={Matrix} />
        <Route path="/flagged" component={Flagged} />
        <Route path="/hidden-gems" component={HiddenGems} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/:slug" component={ReportDetail} />
        <Route path="/operations" component={Operations} />
        <Route path="/screening" component={Screening} />
        <Route path="/ai-interviews" component={AiInterviews} />
        <Route path="/tech-interviews" component={TechInterviews} />
        <Route path="/placed" component={Placed} />
        <Route path="/settings" component={Settings} />
        <Route path="/backup" component={Backup} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <Provider>
      <Switch>
        {/* Public: landing / sign-in and the candidate interview room */}
        <Route path="/" component={Index} />
        <Route path="/interview/:token" component={AiInterviewRoom} />
        <Route component={Workspace} />
      </Switch>
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
      {/* "Made with Runable" badge - if user asks to remove the runable badge, remove this code as well as comment */}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
