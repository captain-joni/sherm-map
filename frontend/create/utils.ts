export function splitCoordinates(str: string): string[] {
    let strSplit = str.replaceAll(' ', '').split(",");

    if(strSplit.length != 2
        || !validCoordinateString(strSplit[0], 90)
        || !validCoordinateString(strSplit[1], 180))
        {throw new Error("wrong format");}
    return strSplit;
}

function validCoordinateString(str: string, limit: number): boolean {
    let coordRE: RegExp = /^-?\d+(\.\d+)?$/;
    return coordRE.test(str) && Math.abs(Number(str)) <= limit;
}
