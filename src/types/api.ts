import {OutletType} from "../constants";

export type PostControllersPayload = {
    [key in OutletType]?: {
        //pin: internal name
        [key: number]: string;
    };
};