export interface Mat {
    delete(): void;
    rows: number;
    cols: number;
    type(): number;
    data: Uint8Array;
    roi(rect: Rect): Mat;
    copyTo(dst: Mat): void;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}
