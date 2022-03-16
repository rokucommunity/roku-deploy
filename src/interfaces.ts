
export interface StandardizedFileEntry {
    /**
     * The full path to the source file
     */
    src: string;
    /**
     * The path relative to the root of the pkg to where the file should be placed
     */
    dest: string;
}

export interface HttpResponse {
    response: any;
    body: any;
}

export interface ManifestData {
    [key: string]: any;
    keyIndexes?: Record<string, number>;
    lineCount?: number;
}

export interface BeforeZipCallbackInfo {
    /**
     * Contains an associative array of the parsed values in the manifest
     */
    manifestData: ManifestData;
    stagingFolderPath: string;
}
