export interface ImmutableFileBackup { readonly target: string; readonly previouslyExisted: boolean; readonly preRevision: string | null; readonly expectedPostRevision: string | null; readonly contentRef: string | null; readonly createdAt: string; }
export interface GitSnapshot { readonly root: string; readonly commit: string; readonly branch: string; readonly clean: boolean; readonly createdAt: string; }
export interface PackageManifestSnapshot { readonly manager: string; readonly manifestRevisions: Readonly<Record<string,string>>; readonly installedEnvironmentRestored: false; }
