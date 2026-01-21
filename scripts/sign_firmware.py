Import("env")
import os
import shutil


def sign_before_upload(source, target, env):
    bin_path = str(source[0])
    # sign bin_path here
    build_dir = env.subst("$BUILD_DIR")
    progname = env.subst("$PROGNAME")

    signed_path = os.path.join(build_dir, progname + ".signed.bin")

    framework_dir = env.PioPlatform().get_package_dir("framework-arduinoespressif8266")
    signing_tool = os.path.join(framework_dir, "tools", "signing.py")

    private_key = os.path.join(env.subst("$PROJECT_DIR"), "keys", "private.pem")

    # Sign firmware
    env.Execute(
        f'python "{signing_tool}" '
        f"--mode sign "
        f'--privatekey "{private_key}" '
        f'--bin "{bin_path}" '
        f'--out "{signed_path}"'
    )

    # Replace original binary so upload uses signed version
    shutil.move(signed_path, bin_path)

    print("Firmware signed and ready for upload")


env.AddPreAction("upload", sign_before_upload)
