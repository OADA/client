// Some useful functions

export function toStringPath(path: Array<string>): string {
  return "/" + path.join("/");
}

export function toArrayPath(path: string): Array<string> {
  let arrayPath = path.split("/");
  if (arrayPath.length > 0 && arrayPath[0] == "") {
    arrayPath.shift();
  }
  if (arrayPath.length > 0 && arrayPath[arrayPath.length - 1] == "") {
    arrayPath.pop();
  }
  return arrayPath;
}

export function getObjectAtPath(tree: object, path: Array<string>): object {
  return path.reduce((acc, nextKey) => {
    if (acc[nextKey]) {
      return acc[nextKey];
    } else if (acc["*"]) {
      return acc["*"];
    } else {
      throw new Error(
        "Specified path /" + path.join("/") + " does not exist in the tree."
      );
    }
  }, tree);
}

export function toTreePath(tree: object, path: Array<string>): Array<string> {
  let treePath: string[] = [];
  path.reduce((acc, nextKey) => {
    if (acc[nextKey]) {
      treePath.push(nextKey);
      return acc[nextKey];
    } else if (acc["*"]) {
      treePath.push("*");
      return acc["*"];
    } else {
      throw new Error(
        "Specified path /" + path.join("/") + " does not exist in the tree."
      );
    }
  }, tree);
  return treePath;
}

export function isResource(tree: object, path: Array<string>): boolean {
  const obj = getObjectAtPath(tree, path);
  if ("_id" in obj) {
    return true;
  } else {
    return false;
  }
}

export function createNestedObject(
  obj: object,
  nestPath: Array<string>
): object {
  const reversedArray = nestPath.slice().reverse();
  return reversedArray.reduce((acc, nextKey) => {
    let newObj = {};
    newObj[nextKey] = acc;
    return newObj;
  }, obj);
}

// Return delay promise
// Reference: https://gist.github.com/joepie91/2664c85a744e6bd0629c#gistcomment-3082531
export function delay(ms: number) {
  return new Promise((_) => setTimeout(_, ms));
}
