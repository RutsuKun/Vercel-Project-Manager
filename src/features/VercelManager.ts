/* eslint-disable @typescript-eslint/naming-convention */
// 👆 because vercel API requires snake_case keys
import { window, workspace } from "vscode";
import { Api } from "../utils/Api";
import type { TokenManager } from "./TokenManager";
import type {
  Deployment,
  VercelEnvironmentInformation,
  VercelResponse,
  VercelTargets,
} from "./models";
import { getTokenOauth } from "../utils/oauth";

export class VercelManager {
  public onDidEnvironmentsUpdated: () => void = () => {};
  public onDidLogOut: () => void = () => {};
  public onDidDeploymentsUpdated: () => void = () => {};

  public onDidProjectSelected: () => void = () => {};

  private projectInfo: VercelResponse.info.project | null = null;
  private userInfo: VercelResponse.info.User | null = null;

  public constructor(private readonly token: TokenManager) {
    const refreshRate = workspace
      .getConfiguration("vercel")
      .get("RefreshRate") as number;
    setInterval(
      () => {
        this.onDidDeploymentsUpdated();
        this.onDidEnvironmentsUpdated();
      },
      (refreshRate ?? 5) * 60 * 1000
    ); // refresh every refreshRate mins

    //retains this value of vercel
    token.onProjectStateChanged = (_id?: string) => {
      this.onDidDeploymentsUpdated();
      this.onDidEnvironmentsUpdated();
      // force refresh of info on next call.
      this.projectInfo = null;
      this.userInfo = null;
    };
  }

  async logIn(): Promise<boolean> {
    const apiToken = await getTokenOauth();
    if (!apiToken) return false;
    await this.token.setAuth(apiToken);
    this.onDidDeploymentsUpdated();
    this.onDidEnvironmentsUpdated();
    await this.token.onDidLogIn();
    return true;
  }

  /**
   * Un-sets authentication and project and calls didLogOut, didDeploymentsUpdated, and didEnvironmentsUpdates;
   */
  async logOut() {
    await this.token.setAuth(undefined);
    await this.token.setProject(undefined);
    this.onDidLogOut();
    this.token.onDidLogOut();
    this.onDidDeploymentsUpdated();
    this.onDidEnvironmentsUpdated();
  }

  /** Utility getter to return project id */
  get selectedProject() {
    return this.token.getProject();
  }
  /** Utility getter to return authentication token */
  get auth() {
    return this.token.getAuth();
  }
  /** Utility getter to return the proper fetch options for authentication  */
  private async authHeader() {
    const auth = await this.auth;
    if (!auth) throw new Error("Not authenticated. Ensure user is logged in!");
    return {
      headers: { Authorization: `Bearer ${auth}` },
    };
  }

  project = {
    getInfo: async (refresh: boolean = false) => {
      if (this.projectInfo !== null && !refresh) return this.projectInfo;
      const selectedProject = this.selectedProject;
      if (!selectedProject)
        return void window.showErrorMessage("No project selected!");
      const result = await Api.projectInfo(
        { projectId: selectedProject },
        await this.authHeader()
      );
      if (!result.ok) return;
      return (this.projectInfo = result);
    },
  };
  user = {
    getInfo: async (refresh: boolean = false) => {
      if (this.userInfo !== null && !refresh) return this.userInfo;
      const response = await Api.userInfo({}, await this.authHeader());
      if (!response.ok) return;
      return (this.userInfo = response.user);
    },
  };
  private envList: VercelEnvironmentInformation[] | null = null;
  env = {
    /**
     * @returns an array of environment variables for the current project from vercel,
     * or undefined if no project is selected or no user is authenticated
     */
    getAll: async (): Promise<VercelEnvironmentInformation[]> => {
      if (!(await this.auth) || !this.selectedProject) return [];
      const response = await Api.environment.getAll(
        { projectId: this.selectedProject },
        await this.authHeader()
      );
      if (!response.ok) return (this.envList = []);
      const r = "envs" in response ? response.envs ?? [] : [response];
      return (this.envList = r);
    },
    /** returns the environment variable list, updating it if null */
    getEnvList: async () => {
      return await (this.envList ?? this.env.getAll());
    },
    /**
     *
     * @param key Name of var to create
     * @param value Value to store in variable
     * @param target Deployment targets to set to
     */
    create: async (key: string, value: string, target: VercelTargets[]) => {
      const projectId = this.selectedProject;
      if (!projectId)
        return void window.showErrorMessage("No project selected!");
      await Api.environment.create(
        { projectId, body: { key, value, target, type: "encrypted" } },
        await this.authHeader()
      );
      this.onDidEnvironmentsUpdated();
    },

    /**
     * Deletes an environment variable based on ID
     * @param id A string corresponding to the Vercel ID of the env variable
     */
    remove: async (id: string) => {
      const projectId = this.selectedProject;
      if (!projectId)
        return void window.showErrorMessage("No project selected!");
      await Api.environment.remove({ projectId, id }, await this.authHeader());
      this.onDidEnvironmentsUpdated();
    },
    /**
     *
     * @param id A string corresponding the ID of the Environment Variable
     * @param value The value to set the Variable to
     * @param targets Deployment targets to set to
     */
    edit: async (id: string, value: string, targets: VercelTargets[]) => {
      const selectedProject = this.selectedProject;
      if (!selectedProject)
        return void window.showErrorMessage("No project selected!");
      await Api.environment.edit(
        {
          projectId: selectedProject,
          id,
          body: {
            value,
            target: targets,
          },
        },
        {
          headers: (await this.authHeader()).headers,
        }
      );
      this.onDidEnvironmentsUpdated();
    },
  };
  private deploymentsList: Deployment[] | null = null;
  /** returns the environment variable list, updating it if null */
  async getDeploymentsList() {
    while (this.fetchingDeployments); //If fetching, wait until done.
    return await (this.deploymentsList ?? this.deployments.getAll());
  }
  private fetchingDeployments = false;
  deployments = {
    /**
     * @returns A list of deployments for the currently selected project and
     * user or empty list if either doesn't exist
     */
    getAll: async () => {
      if (!this.selectedProject || !(await this.auth)) return [];
      try {
        this.fetchingDeployments = true;
        const limit = workspace
          .getConfiguration("vercel")
          .get("DeploymentCount") as number;
        const data = await Api.deployments(
          {
            projectId: this.selectedProject,
            limit: limit ?? 20,
          },
          await this.authHeader()
        );
        if (!data.ok) return (this.deploymentsList = []);
        const r = data.deployments ?? [];
        return (this.deploymentsList = r);
      } finally {
        this.fetchingDeployments = false;
      }
    },
  };
}
