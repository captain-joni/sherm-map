export function splitCoordinates(str: string): string[] {
    let strSplit = str.replaceAll(' ', '').split(",");

    if(strSplit.length != 2
        || !validCoordinateString(strSplit[0])
        || !validCoordinateString(strSplit[1]))
        {throw new Error("wrong format");}
    return strSplit;
}

function validCoordinateString(str: string): boolean {
    let coordRE: RegExp = /^-?\d+(\.\d+)?$/;
    return coordRE.test(str);
}
