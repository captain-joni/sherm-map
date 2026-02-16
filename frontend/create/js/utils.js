export function splitCoordinates(str) {
    let strSplit = str.replaceAll(' ', '').split(",");
    if (strSplit.length != 2
        || !validCoordinateString(strSplit[0])
        || !validCoordinateString(strSplit[1])) {
        throw new Error("wrong format");
    }
    return strSplit;
}
function validCoordinateString(str) {
    let coordRE = /^-?\d+(\.\d+)?$/;
    return coordRE.test(str);
}
